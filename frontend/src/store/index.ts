import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux'
import authReducer from './slices/authSlice'
import accountsReducer from './slices/accountsSlice'
import campaignsReducer from './slices/campaignsSlice'
import statsReducer from './slices/statsSlice'
import emailsReducer from './slices/emailsSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    accounts: accountsReducer,
    campaigns: campaignsReducer,
    stats: statsReducer,
    emails: emailsReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
