import { Route, Routes } from 'react-router-dom'
import HomePage from '../pages/HomePage'
import JoinPage from '../pages/JoinPage'
import RoomPage from '../pages/RoomPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/join/:roomId" element={<JoinPage />} />
      <Route path="/rooms/:roomId" element={<RoomPage />} />
    </Routes>
  )
}
