// BOARD-107: lint fixture. Application domain terms in identifier names, strings, and templates.
export const postId = 'x';
export function createCampaign() {
  return { approvalStatus: 'pending', BRAND_COLOR: '#000' };
}
export type TaskList = string[];

// String literals and template text: one violation per line.
export const kind = 'post';
export const heading = 'Task list';
export const status = 'approval-status';
export const label = `Kampanye ${kind}`;
export const ns = 'tayang.plugin';
export const plural = 'tasks-runner';
