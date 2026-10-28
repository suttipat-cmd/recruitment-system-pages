import { esc } from './domain';

// Shared markup: business actions and field names remain owned by each screen.
export const button = (text: string, act: string, cls = '') =>
  `<button type="button" data-action="${act}" class="${cls}">${text}</button>`;

export function field(name: string, label: string, value: unknown = '', required = false, type = 'text', extra = '') {
  return `<label>${label}${required ? '<span class="req">*</span>' : ''}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${extra}></label>`;
}

export function select(name: string, label: string, options: string, required = false) {
  return `<label>${label}${required ? '<span class="req">*</span>' : ''}<select name="${name}" ${required ? 'required' : ''}>${options}</select></label>`;
}

export const note = (value: unknown = '', required = false, label = 'บันทึก / เหตุผล') =>
  `<label class="full">${label}${required ? '<span class="req">*</span>' : ''}<textarea name="note" maxlength="5000" ${required ? 'required' : ''}>${esc(value)}</textarea></label>`;
