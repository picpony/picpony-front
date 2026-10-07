import type { AssistantAction } from './protocol';

export interface ActionGroup { action: AssistantAction; originals: AssistantAction[] }
const search = (action: AssistantAction) => action.name === 'search_images' || action.name === 'set_search_filters';

/** A query and its adjacent filter adjustments are one search, with a receipt for each call. */
export function actionGroups(actions: readonly AssistantAction[]): ActionGroup[] {
  const groups: ActionGroup[] = [];
  for (const action of actions) {
    const previous = groups.at(-1);
    if (search(action) && previous && search(previous.action)) {
      const hasQuery = Object.hasOwn(action.arguments, 'query');
      previous.action = { ...action, name: 'search_images', arguments: {
        ...previous.action.arguments, ...action.arguments,
        ...(hasQuery ? { query_mode: action.arguments.query_mode || (action.name === 'set_search_filters' ? 'refine' : 'new') } : {}),
      } };
      previous.originals.push(action);
    } else {
      groups.push({ action: search(action) && Object.hasOwn(action.arguments, 'query') ? { ...action, arguments: { ...action.arguments, query_mode: action.arguments.query_mode || (action.name === 'set_search_filters' ? 'refine' : 'new') } } : action, originals: [action] });
    }
  }
  return groups;
}
