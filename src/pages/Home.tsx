import { useState } from 'react'
import EditorSection from '../components/EditorSection'
import Footer from '../components/Footer'
import Header from '../components/Header'
import ModalLogin from '../components/ModalLogin'
import ResultSection from '../components/ResultSection'
import UploadSection from '../components/UploadSection'
import UtilityPanel from '../components/UtilityPanel'

function Home() {
  const [isLoginOpen, setIsLoginOpen] = useState(false)

  return (
    <div className="min-h-screen bg-ellie-ivory text-ellie-text">
      <Header
        onLoginClick={() => setIsLoginOpen(true)}
        onUpgradeClick={() => setIsLoginOpen(true)}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-36 pt-24 sm:px-6 lg:px-8">
        <UploadSection />
        <EditorSection />
        <ResultSection />
        <UtilityPanel />
      </main>
      <Footer />
      <ModalLogin open={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
    </div>
  )
}

export default Home
