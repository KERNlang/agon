/** Empty answers can mean host dismissal, never permission to execute. */
export function isExplicitApproval(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}
