import z from 'zod'

export const lineSchema = z.object({
  command: z.string().describe('The command that generated the log'),
  args: z.array(z.string()).describe('Arguments passed to the command'),
  stream: z.enum(['stdout', 'stderr']).describe('Stream type of the log'),
  data: z.string().describe('The log content'),
  timestamp: z.number().describe('The timestamp of the log entry'),
})

export const linesSchema = z.object({
  lines: z.array(lineSchema),
  previous: z.array(lineSchema),
})

export const resultSchema = z.object({
  shouldBeFixed: z
    .boolean()
    .describe(
      'Whether the logs contain actionable errors that require code fixes (not just warnings or info messages)'
    ),
  summary: z
    .string()
    .describe(
      'A summary of actionable errors found in the logs, including error types, affected files, and specific failure reasons. Empty if no actionable errors found. It can be Markdown for better readability.'
    ),
  paths: z.array(
    z.string().describe('List of file paths that contain actionable errors.')
  ),
})

export type Line = z.infer<typeof lineSchema>
export type Lines = z.infer<typeof linesSchema>
