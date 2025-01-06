// Backend/controllers/enumController.js
import { queryToDatabase } from '../utils/queryUtils.js';

export async function getEnumValues(type) {
  const enumTypes = {
    genre: 'genre_enum',
    category: 'category_enum',
    mood: 'mood_enum'
  };

  const enumType = enumTypes[type];
  if (!enumType) {
    throw new Error('Invalid enum type');
  }

  const query = `SELECT enum_range(NULL::${enumType})`;
  try {
    const result = await queryToDatabase(query);
    const enumValues = result.rows[0].enum_range.replace(/[{}]/g, '').split(',');

    // Sanitize the enum values to remove any extraneous quotes
    const sanitizedEnumValues = enumValues.map(value => value.replace(/^"|"$/g, ''));

    return sanitizedEnumValues;
  } catch (error) {
    throw error;
  }
}