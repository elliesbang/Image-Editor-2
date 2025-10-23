import { useState } from 'react'

import EllieHeader from '../components/ellie/EllieHeader'
import EditSection from '../components/ellie/EditSection'
import ExtraFeatureSection from '../components/ellie/ExtraFeatureSection'
import ImageUploadSection from '../components/ellie/ImageUploadSection'
import ResultSection from '../components/ellie/ResultSection'
import Footer from '../components/Footer'
import ModalLogin from '../components/ModalLogin'

function Home() {
  const [loginOpen, setLoginOpen] = useState(false)

  const handleLoginClick = () => {
    setLoginOpen(true)
  }

  const handleUpgradeClick = () => {
    alert('업그레이드 기능은 곧 제공될 예정이에요!')
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#fffef9] text-[#404040]">
      <EllieHeader onLoginClick={handleLoginClick} onUpgradeClick={handleUpgradeClick} />
      <ModalLogin open={loginOpen} onClose={() => setLoginOpen(false)} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col space-y-10 px-4 pb-16 pt-24 sm:px-6 lg:px-8">
        <ImageUploadSection />
        <EditSection />
        <ExtraFeatureSection />
        <ResultSection />
      </main>
      <Footer />
    </div>
  )
}

export default Home
