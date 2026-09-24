import { dbError, type Admin } from './api';
import { inspectTemplate } from './layout';

export type Template = { id: string; filename: string; png_base64: string; has_transparency: boolean; updated_at: string };
export async function getTemplate(admin: Admin): Promise<Template | null> {
  const { data, error } = await admin.from('canva_tryon_template').select('*').eq('id', 'default').maybeSingle();
  dbError(error); return data;
}
export async function saveTemplate(admin: Admin, userId: string, input: Buffer) {
  const { hasTransparency } = await inspectTemplate(input);
  dbError((await admin.from('canva_tryon_template').upsert({ id: 'default', filename: 'modelo-prova-online-000mm.png',
    png_base64: input.toString('base64'), has_transparency: hasTransparency, updated_at: new Date().toISOString(), updated_by: userId })).error);
  return { hasTransparency };
}
