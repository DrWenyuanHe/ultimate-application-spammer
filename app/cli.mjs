#!/usr/bin/env node
// Single entry point for agents and people: `node app/cli.mjs <command> ...`.
// Run `node app/cli.mjs help` for the list. Data commands print JSON.

const major = Number(process.versions.node.split('.')[0])
if (major < 24) {
  console.log(`[Ultimate Application Spammer] status: needs-repair\nNode.js ${process.versions.node} is too old; version 24 or newer is required.\nFix: install Node.js 24 LTS (Windows: winget install OpenJS.NodeJS.LTS; macOS: brew install node), then reopen the terminal. See app/skills/setup.md.`)
  process.exit(process.argv.includes('--brief') ? 0 : 1)
}

const { main } = await import('./lib/commands.mjs')
try {
  await main(process.argv.slice(2))
} catch (error) {
  const status = error.status ? ` (${error.status})` : ''
  console.error(`Error${status}: ${error.message}`)
  if (error.details?.existingId) console.error(`Existing record: ${error.details.existingId}`)
  process.exit(1)
}
