import { error, info, startGroup, endGroup } from '@actions/core'
import { context } from '@actions/github'
import { readFileSync } from 'fs'
import { callLaceworkCli } from './util'
import { Location, Result, Log } from 'sarif'
import { Issue } from './types'

export async function printSarifResults(componentName: string, sarifFile: string) {
  startGroup('Results for ' + componentName.toUpperCase())
  let foundSomething = false
  const results: Log = JSON.parse(readFileSync(sarifFile, 'utf8'))
  for (const run of results.runs) {
    if (Array.isArray(run.results) && run.results.length > 0) {
      foundSomething = true
      info('Found ' + run.results?.length + ' results using ' + run.tool.driver.name)
      for (const vuln of run.results) {
        info(JSON.stringify(vuln, null, 2))
      }
    }
  }
  if (!foundSomething) {
    info('No ' + componentName.toUpperCase() + ' issues were found')
  }
  endGroup()
}

export async function compareSarifResults(
  componentName: string,
  oldReport: string,
  newReport: string
): Promise<Issue[]> {
  startGroup(`Comparing ${componentName.toUpperCase()} results`)
  const outputFile = `${componentName}$-compare.sarif`
  info(
    await callLaceworkCli(
      componentName,
      'compare',
      '--old',
      oldReport,
      '--new',
      newReport,
      '-o',
      outputFile
    )
  )

  const results: Log = JSON.parse(readFileSync(outputFile, 'utf8'))
  let sawChange = false
  let CveToDescription = new Map<string, string>()
  const alertsAdded: Issue[] = []

  for (const run of results.runs) {
    let prettyPrintDetails: (vuln: Result) => string | undefined
    let prettyPrintMessage: (vuln: Result) => string
    switch (componentName.toUpperCase()) {
      case 'SAST': {
        prettyPrintDetails = prettyPrintSastDetails
        prettyPrintMessage = prettyPrintSastMessage
        break
      }

      case 'SCA': {
        if (Array.isArray(run.tool.driver.rules) && run.tool.driver.rules.length > 0) {
          for (const rule of run.tool.driver.rules) {
            info(`Adding ${rule.id} to map with short description ${rule.shortDescription}`)

            if (rule.shortDescription) {
              CveToDescription.set(rule.id, rule.shortDescription.text)
            } else {
              CveToDescription.set(rule.id, 'No information available on alert.')
            }
            info(`Map size: ${CveToDescription.size}`)
          }
        }
        prettyPrintDetails = prettyPrintScaDetails
        prettyPrintMessage = (vuln: Result) => {
          return prettyPrintScaMessage(CveToDescription, vuln)
        }
        break
      }
      default:
        return []
    }
    if (Array.isArray(run.results) && run.results.length > 0) {
      info('There was changes in ' + run.results.length + ' results from ' + run.tool.driver.name)
      for (const vuln of run.results) {
        info(JSON.stringify(vuln, null, 2))
        if (vuln.properties?.['status'] === 'added') {
          let details = prettyPrintDetails(vuln)
          const message = prettyPrintMessage(vuln)
          if (Array.isArray(vuln.locations) && vuln.locations.length > 0) {
            for (const location of vuln.locations) {
              alertsAdded.push({
                summary: `${prettyPrintSarifLocation(location)}: ${message}`,
                details,
              })
            }
          } else {
            alertsAdded.push({
              summary: `Unknown location: ${message}`,
              details,
            })
          }
        }
      }
      if (alertsAdded.length > 0) {
        // TODO: Use setFailed once we want new alerts to cause a failure
        error(
          `${
            alertsAdded.length
          } new ${componentName.toUpperCase()} issues were introduced, see above in the logs for details`
        )
      }
    }
  }
  if (!sawChange) {
    info(`No changes in ${componentName.toUpperCase()} issues`)
  }
  endGroup()
  return alertsAdded
}

function prettyPrintSastDetails(vuln: Result) {
  let details = undefined
  if (
    vuln.codeFlows !== undefined &&
    vuln.codeFlows.length > 0 &&
    vuln.codeFlows[0].threadFlows.length > 0
  ) {
    const chosenFlow = vuln.codeFlows[0].threadFlows[0]
    details = 'Example problematic flow of data:\n\n'
    for (const flowLoc of chosenFlow.locations) {
      const location = flowLoc.location
      details += `  * ${prettyPrintSarifLocation(location)}`
      if (location?.message?.text !== undefined) {
        details += `: ${location.message.text}`
      }
      details += '\n'
    }
  }
  return details
}

function prettyPrintSastMessage(vuln: Result): string {
  return vuln.message.markdown || vuln.message.text || 'No information available on alert'
}

function prettyPrintScaDetails(vuln: Result) {
  let details = vuln.message.text || 'No information available on alert'
  details += `\n`
  return details
}

function prettyPrintScaMessage(map: Map<string, string>, vuln: Result): string {
  if (vuln.ruleId) {
    info(`Map size: ${map.size}`)

    return map.get(vuln.ruleId) || 'Debuggg... No information available on alert'
  } else {
    return 'No information available on alert'
  }
}

function prettyPrintSarifLocation(sarifLocation: Location | undefined) {
  const uri = sarifLocation?.physicalLocation?.artifactLocation?.uri
  const startLine = sarifLocation?.physicalLocation?.region?.startLine
  const endLine = sarifLocation?.physicalLocation?.region?.endLine
  if (uri !== undefined && startLine !== undefined) {
    const file = uri.replace(/^file:\/*/, '')
    if (endLine !== undefined) {
      const text = `${file.split('/').pop()}:${startLine}-${endLine}`
      const url = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${file}#L${startLine}-L${endLine}`
      return `[${text}](${url})`
    } else {
      const text = `${file.split('/').pop()}:${startLine}`
      const url = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/blob/${context.sha}/${file}#L${startLine}`
      return `[${text}](${url})`
    }
  }
  return 'Unknown location'
}
