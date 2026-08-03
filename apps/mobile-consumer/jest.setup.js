// Setup Jest untuk React Native.
// Matcher jest-native sudah bawaan React Native Testing Library v12.4+,
// jadi tidak perlu import tambahan.

// Mock modul native yang tidak tersedia di lingkungan tes Node.
jest.mock('expo-location');
jest.mock('expo-task-manager');
