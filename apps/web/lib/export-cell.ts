export type SpreadsheetCell = string | number;

export function safeSpreadsheetCell(value: SpreadsheetCell): SpreadsheetCell {
  if (typeof value !== "string" || value.length === 0) return value;
  return /^[\t\r\n =+\-@]/.test(value) && /[\t\r\n ]*[=+\-@]/.test(value)
    ? `'${value}`
    : value;
}

export function safeSpreadsheetRows<T extends SpreadsheetCell[][]>(rows: T): T {
  return rows.map((row) => row.map(safeSpreadsheetCell)) as T;
}
