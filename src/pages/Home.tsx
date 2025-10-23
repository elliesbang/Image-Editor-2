import EllieHeader from '../components/ellie/EllieHeader'
import EditSection from '../components/ellie/EditSection'
import ExtraFeatureSection from '../components/ellie/ExtraFeatureSection'
import ImageUploadSection from '../components/ellie/ImageUploadSection'
import ResultSection from '../components/ellie/ResultSection'

function Home() {
  const handleLoginClick = () => {
    alert('로그인 기능은 준비 중이에요!')
  }

  const handleUpgradeClick = () => {
    alert('업그레이드 기능은 곧 제공될 예정이에요!')
  }

  return (
    <div className="min-h-screen bg-[#fffef9] text-[#404040]">
      <EllieHeader onLoginClick={handleLoginClick} onUpgradeClick={handleUpgradeClick} />
      <main className="mx-auto flex w-full max-w-6xl flex-col space-y-10 px-4 pb-16 pt-24 sm:px-6 lg:px-8">
        <ImageUploadSection />
        <EditSection />
        <ExtraFeatureSection />
        <ResultSection />
      </main>
    </div>
  )
}

export default Home
