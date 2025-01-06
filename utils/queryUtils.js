import database from '../models/db.js';

export async function queryToDatabase(query, values = []) {
  
  try {
    const result = await database.query(query, values);
    return result;
  } catch (error) {
    throw error;
  }
}
