// RFC-0043 — GCDR Copiloto. Runs an Anthropic tool-use loop bound to the
// read-only tool registry, scoped to the caller's tenant. Transport-agnostic
// (the HTTP controller is the only caller today).
import Anthropic from '@anthropic-ai/sdk';
import { makeContext } from '../../mcp/context';
import { ASSISTANT_TOOLS, toolByName } from './registry';
import { AppError } from '../../shared/errors/AppError';

const MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-4-6';
const MAX_STEPS = 6;

const SYSTEM = `You are the GCDR Copiloto, a read-only assistant inside the MYIO GCDR platform.
You help operations staff understand customers, work orders (OS), devices, maintenance, installation progress and alarm rules.
- Use the provided tools to fetch real data; never invent numbers, codes or names.
- All tools are already scoped to the current tenant; you cannot see other tenants' data.
- You are READ-ONLY: you cannot create, edit, schedule or cancel anything. If asked, explain that and point to the relevant screen.
- Answer in the user's language (Portuguese by default). Be concise; prefer short paragraphs and small lists.
- When you cite a work order, use its code (e.g. OS-ABC1D2). When data is missing, say so plainly.`;

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantResult {
  answer: string;
  toolCalls: string[];
}

export function isAssistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function runAssistant(
  tenantId: string,
  message: string,
  history: AssistantMessage[] = [],
): Promise<AssistantResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AppError(
      'ASSISTANT_NOT_CONFIGURED',
      'Assistant is not configured (ANTHROPIC_API_KEY missing).',
      503,
    );
  }

  const client = new Anthropic({ apiKey });
  const ctx = makeContext(tenantId);
  const tools: Anthropic.Tool[] = ASSISTANT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const toolCalls: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools,
      messages,
    });

    if (resp.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: resp.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of resp.content) {
        if (block.type !== 'tool_use') continue;
        toolCalls.push(block.name);
        const tool = toolByName.get(block.name);
        let output: unknown;
        try {
          output = tool
            ? await tool.run(ctx, block.input)
            : { success: false, message: `Unknown tool: ${block.name}` };
        } catch (err) {
          output = {
            success: false,
            message: err instanceof Error ? err.message : String(err),
          };
        }
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    const answer = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return { answer, toolCalls };
  }

  return {
    answer: 'Não consegui concluir a resposta (muitos passos de consulta). Tente reformular a pergunta.',
    toolCalls,
  };
}
