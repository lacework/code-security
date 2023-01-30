import { error, getInput, info, setOutput } from '@actions/core'
import { existsSync } from 'fs'
import {
  downloadArtifact,
  postCommentIfInPr,
  resolveExistingCommentIfFound,
  uploadArtifact,
} from './actions'
import { printSarifResults, compareSarifResults } from './sarif'
import { Issue } from './types'
import { callLaceworkCli } from './util'

const scaReport = 'sca.sarif'
const sastReport = 'sast.sarif'

async function runAnalysis() {
  const target = getInput('target')
  info('Analyzing ' + target)
  const tools = (getInput('tools') || 'sca').toLowerCase().split(',')
  const toUpload: string[] = []
  if (tools.includes('sca')) {
    info(await callLaceworkCli('sca', 'dir', '.', '-o', scaReport, '-f', 'sarif'))
    await printSarifResults('sca', scaReport)
    toUpload.push(scaReport)
  }
  if (tools.includes('sast')) {
    info(
      await callLaceworkCli(
        'sast',
        'scan',
        '--verbose',
        '--classes',
        getInput('jar'),
        '-o',
        sastReport
      )
    )
    await printSarifResults('sast', sastReport)
    toUpload.push(sastReport)
  }
  await uploadArtifact('results-' + target, ...toUpload)
  setOutput(`${target}-completed`, true)
}

async function displayResults() {
  info('Displaying results')
  await downloadArtifact('results-old')
  await downloadArtifact('results-new')
  const issuesByTool: { [tool: string]: Issue[] } = {}
  if (existsSync(`results-old/${scaReport}`) && existsSync(`results-new/${scaReport}`)) {
    issuesByTool['sca'] = await compareSarifResults(
      `sca`,
      `results-old/${scaReport}`,
      `results-new/${scaReport}`
    )
  }
  if (existsSync(`results-old/${sastReport}`) && existsSync(`results-new/${sastReport}`)) {
    issuesByTool['sast'] = await compareSarifResults(
      `sast`,
      `results-old/${sastReport}`,
      `results-new/${sastReport}`
    )
  }
  if (Object.values(issuesByTool).some((x) => x.length > 0) && getInput('token').length > 0) {
    info('Posting comment to GitHub PR as there were new issues introduced:')
    let message = `Lacework Code Analysis found potential new issues in this PR.`
    for (const [tool, issues] of Object.entries(issuesByTool)) {
      if (issues.length > 0) {
        message += `\n\n<details><summary>${tool} found ${issues.length} potential new issues</summary>\n\n`
        for (const issue in issues) {
          message += `* ${issues[issue].summary}\n`
          const details = issues[issue].details?.replaceAll('\n', '\n  ')
          if (details !== undefined) {
            message += `  <details><summary>More details</summary>\n  ${details}\n  </details>\n`
          }
        }
        message += '\n</details>'
      }
    }
    info(message)
    const commentUrl = await postCommentIfInPr(message)
    if (commentUrl !== undefined) {
      setOutput('posted-comment', commentUrl)
    }
  } else {
    await resolveExistingCommentIfFound()
  }
  setOutput(`display-completed`, true)
}

async function main() {
  if (getInput('target') !== '') {
    await runAnalysis()
  } else {
    await displayResults()
  }
}

main().catch(
  (err) => error(err.message) // TODO: Use setFailed once we want failures to be fatal
)
