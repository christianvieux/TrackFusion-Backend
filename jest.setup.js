// jest.setup.js
jest.mock('../models/db.js', () => ({
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn(),
}));