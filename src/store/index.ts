import { configureStore } from '@reduxjs/toolkit';
import dependencyReducer from './dependencySlice';

export const store = configureStore({
  reducer: {
    dependencies: dependencyReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;