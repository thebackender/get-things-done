// Tasks tab: the task list on the left, the calendar on the right. Both show the same tasks (Sprint / All).
import * as list from './list.js';
import * as calendar from './calendar.js';
import { freshBox } from '../util.js';

export function render(view) {
  const root = freshBox(view);
  root.innerHTML = `<div class="tasks-layout">
    <section class="list-pane"></section>
    <aside class="cal-pane"></aside>
  </div>`;
  const calPane = root.querySelector('.cal-pane');
  calendar.setFilter(list.scopeFilter);
  list.render(root.querySelector('.list-pane'), { onScopeChange: () => calendar.render(calPane) });
  calendar.render(calPane);
}
