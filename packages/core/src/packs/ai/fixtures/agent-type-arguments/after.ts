import { type Agent, ToolLoopAgent } from 'ai';
import { Agent as Other } from 'other-agents';

export type Researcher = ToolLoopAgent<never, Tools, never>; // @uptide agent-type-arguments at:ToolLoopAgent
export function toolsOf(agent: Agent<never, Tools, Output>) { // @uptide agent-type-arguments at:Agent
  return agent.tools;
}
export const agent = new ToolLoopAgent<never, Tools, never>({ model }); // @uptide agent-type-arguments at:ToolLoopAgent

// Two arguments mean the same in 7; another library's Agent is left alone.
export type Plain = ToolLoopAgent<never, Tools>; // @uptide agent-type-arguments keep at:ToolLoopAgent
export type Foreign = Other<A, B, C>; // @uptide agent-type-arguments keep at:Other
