import { runnableSkills } from "@/features/skills/load-skills";
import { listUserSkills } from "@/features/skills/user-skill-store";
import { listThreadHistory } from "@/features/shell/load-threads";
import { listTasks } from "@/features/tasks/task-store";
import { TasksPanel } from "@/features/tasks/tasks-panel";
import { lockedScreen } from "@/features/vault/page-gate";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";

import {
  createTaskAction,
  deleteTaskAction,
  markTasksSeenAction,
  setTaskEnabledAction,
  setTaskNotifyAction,
} from "./actions";

/** Customize · Tasks (#54): scheduled skill runs, listed and made here. */
export default async function CustomizeTasksPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor);
  const shipped = runnableSkills();
  const [tasks, yours, threads, catalog] = await Promise.all([
    userId === null ? [] : listTasks(userId),
    userId === null ? [] : listUserSkills(userId),
    userId === null ? [] : listThreadHistory(userId),
    fetchChatCatalog(shipped),
  ]);
  return (
    <TasksPanel
      signedIn={actor !== null}
      tasks={tasks}
      skills={[
        ...shipped.map((skill) => ({ id: skill.name, label: `/${skill.name}` })),
        ...yours.map((skill) => ({ id: skill.name, label: `/${skill.name} (yours)` })),
      ]}
      models={(catalog ?? []).map((model) => ({ id: model.id, label: model.name }))}
      threads={threads
        .flatMap((group) => group.threads)
        .slice(0, 50)
        .map((thread) => ({ id: thread.id, label: thread.title }))}
      actions={{
        create: createTaskAction,
        setEnabled: setTaskEnabledAction,
        setNotify: setTaskNotifyAction,
        remove: deleteTaskAction,
        markSeen: markTasksSeenAction,
      }}
    />
  );
}
