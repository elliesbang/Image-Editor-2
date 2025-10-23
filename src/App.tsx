import Home from './pages/Home'
import { ImageEditorProvider } from './hooks/useImageEditor'

function App() {
  return (
    <ImageEditorProvider>
      <Home />
    </ImageEditorProvider>
  )
}

export default App
