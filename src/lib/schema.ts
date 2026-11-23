import { z } from 'zod'
import type { JsonValue, Scenario } from './types'

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
)

const optionSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
})

const levelSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
})

const questionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('noul'),
    instructions: z.string().default(''),
    criteria: z
      .object({ true: z.string().optional(), false: z.string().optional() })
      .optional(),
  }),
  z.object({
    type: z.literal('choice'),
    instructions: z.string().default(''),
    options: z.array(optionSchema),
  }),
  z.object({
    type: z.literal('score'),
    instructions: z.string().default(''),
    levels: z.array(levelSchema),
  }),
  z.object({
    type: z.literal('box'),
    instructions: z.string().default(''),
  }),
])

const apiNodeSchema = z.object({
  kind: z.literal('api').optional(),
  id: z.string().min(1),
  title: z.string().default('未命名步骤'),
  state: jsonValue,
  questions: z.record(z.string(), questionSchema),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  includeUpstream: z.boolean().default(true),
})

const logicOutputSchema = z.object({
  id: z.string().min(1),
  expression: z.string(),
})

const logicNodeSchema = z.object({
  kind: z.literal('logic'),
  id: z.string().min(1),
  title: z.string().default('逻辑判断'),
  outputs: z.array(logicOutputSchema),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
})

// api 在前：旧场景没有 kind 字段，交给 api 分支。
const stepNodeSchema = z.union([apiNodeSchema, logicNodeSchema])

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  when: z
    .object({ output: z.string().min(1), equals: z.boolean() })
    .optional(),
})

export const scenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  model: z.string().min(1),
  nodes: z.array(stepNodeSchema),
  edges: z.array(edgeSchema),
})

export function parseScenario(input: unknown): { scenario?: Scenario; error?: string } {
  const parsed = scenarioSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；') }
  }
  return { scenario: parsed.data as Scenario }
}
