// Obsidian's Plugin.loadData() returns null for a missing data.json but undefined when the file exists
// and cannot be read or parsed (sync conflict, interrupted write), and Plugin.saveData() swallows write
// errors. These helpers keep such a file from being overwritten by defaults and make lost writes visible.

export function dataSafetyStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Copies an unreadable data.json aside. On "failed" the caller must not write data.json this session. */
export async function preserveUnreadableData(adapter, dataPath, now = new Date()) {
  try {
    if (!adapter) throw new Error("vault adapter unavailable");
    if (!(await adapter.exists(dataPath))) return { state: "missing" };
    const backupPath = `${dataPath}.unreadable-${dataSafetyStamp(now)}`;
    await adapter.write(backupPath, await adapter.read(dataPath));
    return { state: "preserved", backupPath };
  } catch (error) {
    return { state: "failed", error };
  }
}
