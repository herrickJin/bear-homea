/**
 * 选购台账服务层：服务端未建（任务 08），第一版全走本地存储 mock。
 * 页面只 import 本层，不直接碰 data/mockLedger——接 API 时在这里换实现
 * （snake_case → camelCase 映射同 inspiration.ts），页面零改动。
 */
import * as mock from "../data/mockLedger";

export type {
  LedgerKind,
  LedgerStatus,
  LedgerItem,
  LedgerDraft,
  LedgerCategory,
} from "../data/mockLedger";
export {
  categoryList,
  categoryPresets,
  channelPresets,
  displayDate,
  filterItems,
  formatPrice,
  groupItems,
  kindLabels,
  priceRange,
  sortItems,
  statusMeta,
  statusOrder,
} from "../data/mockLedger";

export const listItems = mock.listItems;
export const addItem = mock.addItem;
export const updateItem = mock.updateItem;
export const deleteItem = mock.deleteItem;
