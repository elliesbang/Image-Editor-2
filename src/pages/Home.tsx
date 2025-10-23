import { useState } from 'react'
import EditorSection from '../components/EditorSection'
import Footer from '../components/Footer'
import Header from '../components/Header'
import ModalLogin from '../components/ModalLogin'
import ModalSubscriptionPlans from '../components/ModalSubscriptionPlans'
import ResultSection from '../components/ResultSection'
import UploadSection from '../components/UploadSection'
import UtilityPanel from '../components/UtilityPanel'
import Toast from '../components/Toast'

function Home() {
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false)

  return (
    <div className="min-h-screen bg-ellie-ivory text-ellie-text">
      <Header
        onLoginClick={() => setIsLoginOpen(true)}
        onUpgradeClick={() => setIsUpgradeOpen(true)}
      />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pb-36 pt-24 sm:px-6 lg:px-8">
        <UploadSection />
        <EditorSection />
        <ResultSection />
        <UtilityPanel />
      </main>
      <Footer />
      <Toast />
      <ModalLogin open={isLoginOpen} onClose={() => setIsLoginOpen(false)} />
      <ModalSubscriptionPlans
        open={isUpgradeOpen}
        onClose={() => setIsUpgradeOpen(false)}
        currentPlanId="free"
      />
    </div>
  )
}

export default Home
