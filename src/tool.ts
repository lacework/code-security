import { info, startGroup, endGroup, error } from '@actions/core'
import { context } from '@actions/github'
import { existsSync, readFileSync } from 'fs'
import { callLaceworkCli, debug, getRequiredEnvVariable } from './util'
import { Log } from 'sarif'
import { LWJSON } from './lw-json'
import { getPrApi } from './actions'
import { simpleGit, SimpleGitOptions } from 'simple-git'

export async function printResults(tool: string, sarifFile: string) {
  startGroup(`Results for ${tool}`)
  let foundSomething = false
  const results: Log = JSON.parse(readFileSync(sarifFile, 'utf8'))
  for (const run of results.runs) {
    if (Array.isArray(run.results) && run.results.length > 0) {
      foundSomething = true
      info('Found ' + run.results?.length + ' results using ' + tool)
      for (const vuln of run.results) {
        info(JSON.stringify(vuln, null, 2))
      }
    }
  }
  if (!foundSomething) {
    info(`No ${tool} issues were found`)
  }
  endGroup()
}

const options: Partial<SimpleGitOptions> = {
  baseDir: process.cwd(),
  binary: 'git',
  maxConcurrentProcesses: 6,
  trimmed: false,
}

function splitStringAtFirstSlash(inputString: string | undefined): [string, string] {
  if (inputString != null) {
    const [firstPart, secondPart] = inputString.split('/', 2)
    return [firstPart, secondPart]
  }
  return ['', '']
}

export async function createPR(jsonFile: string) {
  const results: LWJSON = JSON.parse(readFileSync(jsonFile, 'utf-8'))
  // get owner and name of current repository
  const [repoOwner, repoName] = splitStringAtFirstSlash(getRequiredEnvVariable('GITHUB_REPOSITORY'))
  info('Owner: ' + repoOwner)
  info('Repo: ' + repoName)
  // New push to PR will delete all prev generated PRs and create new ones
  // corresponding to new version of branch wanting to be pulled into main.

  // Delete PRs generated by autofix
  // Considering just updating the already created PRs for that fixId if made constant to diffs.

  // try {
  //   const {data: prList} = await getPrApi().list({
  //     owner: repoOwner,
  //     repo: repoName,
  //     state: "open",
  //   })
  //   prList.forEach(pr => {
  //   if(pr.title.includes("SCA - Suggested fix for fixId")) {
  //     await getPrApi().
  //   }
  //   });
  // } catch (e) {
  //   error("Error deleting existing SCA genereted PRs: ")
  // }

  // Generate PRs corresponding to new changes to the branch
  results.FixSuggestions?.forEach(async (fix) => {
    let fixId: string = fix.fixId
    let newBranch: string = 'Fix for ' + fixId
    const git = simpleGit(options)
    await git.init()
    // get current branch
    let currBranch = await git.revparse(['--abbrevref', 'HEAD'])
    // create a new branch for the specified fix from currBranch
    await git.checkoutBranch(newBranch, currBranch)

    var patchReport = 'patchSummary.md'
    // create command to run on branch
    var args = [
      'sca',
      'patch',
      '.',
      '--sbom',
      jsonFile,
      '--fix-suggestion',
      fixId,
      '-o',
      patchReport,
    ]
    let patch: string = readFileSync(patchReport, 'utf-8')

    // call patch command
    await callLaceworkCli(...args)

    // commit and push changes
    await git
      .add('./*')
      .commit('Fix Suggestion ' + fixId + '.')
      .addRemote(newBranch, currBranch)
      .push(currBranch, newBranch)

    // open PR
    await getPrApi().create({
      owner: repoOwner,
      repo: repoName,
      head: newBranch,
      base: currBranch,
      title: 'SCA - Suggested fix for fixId: ' + fixId,
      body: patch,
    })
  })
}

export async function compareResults(
  tool: string,
  oldReport: string,
  newReport: string
): Promise<string> {
  startGroup(`Comparing ${tool} results`)
  const args = [
    tool,
    'compare',
    '--old',
    oldReport,
    '--new',
    newReport,
    '--markdown',
    `${tool}.md`,
    '--link',
    `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/$FILENAME#L$LINENUMBER`,
    '--markdown-variant',
    'GitHub',
    '--deployment',
    'ci',
  ]
  if (debug()) args.push('--debug')
  await callLaceworkCli(...args)
  endGroup()
  return existsSync(`${tool}.md`) ? readFileSync(`${tool}.md`, 'utf8') : ''
}
