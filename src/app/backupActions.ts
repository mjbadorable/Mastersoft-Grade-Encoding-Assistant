import { downloadFile } from '../lib/download';
import { serializeWorkspaceBackup, workspaceBackupFileName } from './backup';
import { getMeta } from './db';
import { TEMPLATES_KEY, type ImportTemplate } from './excelImport';
import { useStore } from './store';

/** Downloads every class and the saved import templates as one file, and marks each class as backed up. */
export async function backUpWorkspace(): Promise<void> {
  const { classes, markBackedUp } = useStore.getState();
  const templates = await getMeta<ImportTemplate[]>(TEMPLATES_KEY).catch(() => undefined);
  downloadFile(serializeWorkspaceBackup(classes, templates ? { templates } : {}), workspaceBackupFileName(), 'application/json');
  classes.forEach(markBackedUp);
}
