import { execFile } from 'child_process'
import { promisify } from 'util'
import { parse } from 'shell-quote'

const execFilePromise = promisify(execFile)

export const runShellCommand = async (command: string) => {
  try {
    if (!command.trim()) {
      return { data: '' }
    }

    const args = parse(command)

    if (args.some((arg) => typeof arg !== 'string')) {
      return {
        error: 'Shell features like pipes and redirection are not supported.',
      }
    }

    const [cmd, ...cmdArgs] = args as string[]

    const { stdout, stderr } = await execFilePromise(cmd, cmdArgs)

    if (stderr) {
      return { error: stderr }
    }
    return { data: stdout }
  } catch (error) {
    return { error: error.message }
  }
}
