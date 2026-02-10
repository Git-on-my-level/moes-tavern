export type TaskEvent = {
  taskId: number;
  status: "OPEN" | "ACTIVE" | "SUBMITTED" | "SETTLED" | "CANCELLED";
};

export function countStatus(events: TaskEvent[], status: TaskEvent["status"]) {
  return events.filter((event) => event.status === status).length;
}
