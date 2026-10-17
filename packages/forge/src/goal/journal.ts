import { agonPath, ensureAgonHome } from '@kernlang/agon-core';
import { createGoalJournalStore } from '@kernlang/agon-mod-goal';

export {
  createJournal, addTasks, requeueInflightTasks, nextTask, markStatus, recordAttempt,
  remainingCount, isDone, logEvent, boundEvents, GOAL_EVENT_CAP,
} from '@kernlang/agon-mod-goal';

export const { goalDir, journalPath, saveJournal, loadJournal } = createGoalJournalStore({
  path: agonPath,
  ensureHome: ensureAgonHome,
});
