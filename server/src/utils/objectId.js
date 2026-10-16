import mongoose from 'mongoose';

export function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
