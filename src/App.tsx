import { useMemo, useState } from 'react'
import AnalyzePanel from './features/keywords/AnalyzePanel'
import Notification from './components/Notification'
import LoginPage from './Login'
import SignupPage from './Signup'
import './App.css'

type View = 'editor' | 'login' | 'signup'

type FeatureCard = {
  title: string
  description: string
  accent: string
}

type WorkflowStep = {
  title: string
  detail: string
}

type Plan = {
  name: string
  price: string
  description: string
  features: string[]
}

const featureCards: FeatureCard[] = [
  {
    title: '드래그 앤 드롭 업로드',
    description: '최대 50장의 이미지를 한 번에 업로드하고 썸네일 그리드에서 즉시 확인하세요.',
    accent: '업로드 속도 향상',
  },
  {
    title: '실시간 편집 도구',
    description: '배경 제거, 회전, 크기 조절을 실시간 미리보기로 확인하면서 손쉽게 조정할 수 있습니다.',
    accent: '실시간 미리보기',
  },
  {
    title: 'SEO 키워드 분석',
    description: 'OpenAI 기반 분석으로 이미지와 어울리는 키워드와 제목을 자동으로 추천합니다.',
    accent: 'AI 지원',
  },
]

const workflowSteps: WorkflowStep[] = [
  {
    title: '01. 이미지 업로드',
    detail: '이미지를 끌어다 놓으면 업로드가 시작되며, 자동으로 썸네일이 생성됩니다.',
  },
  {
    title: '02. 편집 & 미리보기',
    detail: '필터, 회전, 배경 제거 도구로 이미지를 조정하고 즉시 결과를 확인하세요.',
  },
  {
    title: '03. 키워드 분석',
    detail: 'AI가 추천하는 키워드와 요약으로 SEO 친화적인 메타데이터를 완성할 수 있습니다.',
  },
  {
    title: '04. 다운로드 & 공유',
    detail: 'PNG, JPG, SVG 등 다양한 형식으로 출력하고 프로젝트별로 저장할 수 있습니다.',
  },
]

const subscriptionPlans: Plan[] = [
  {
    name: 'Free',
    price: '월 0원',
    description: '드래그 앤 드롭 업로드와 기본 편집 도구를 체험해 보세요.',
    features: ['한 번에 최대 3장 업로드', '월 30 크레딧 제공', '키워드 분석 1회 체험'],
  },
  {
    name: 'Standard',
    price: '월 19,900원',
    description: '디자인 팀을 위한 인기 플랜으로, PNG → SVG 변환과 키워드 분석이 강화되었습니다.',
    features: ['한 번에 최대 20장 업로드', '다운로드 횟수 제한 없음', '키워드 분석 50회 제공'],
  },
  {
    name: 'Premium',
    price: '월 39,900원',
    description: '프로덕션 환경에 최적화된 무제한 플랜으로, 모든 기능을 제약 없이 사용하세요.',
    features: ['모든 편집 도구 무제한 사용', '협업을 위한 공유 워크스페이스', 'AI 키워드 분석 무제한'],
  },
]

type EditorLandingProps = {
  onSelectAuth: (view: View) => void
}

function EditorLanding({ onSelectAuth }: EditorLandingProps) {
  const keywordHighlights = useMemo(
    () => [
      '구글 검색 최적화에 맞춘 25개의 키워드 추천',
      '한 번의 클릭으로 키워드 복사 및 공유',
      '한글과 영어를 모두 지원하는 요약 생성',
    ],
    [],
  )

  return (
    <div className="landing">
      <section className="hero" aria-labelledby="hero-heading">
        <div className="hero__content">
          <p className="hero__eyebrow">Easy Image Editor</p>
          <h1 id="hero-heading" className="hero__title">
            드래그 앤 드롭으로 완성하는
            <span className="hero__highlight"> 크리에이티브 워크플로우</span>
          </h1>
          <p className="hero__lead">
            배경 제거, 배치 조정, AI 키워드 분석까지. 한 번에 모든 이미지를 정리하고, 팀과 공유하세요.
          </p>
          <div className="hero__actions">
            <button type="button" className="btn btn--brand" onClick={() => onSelectAuth('signup')}>
              지금 시작하기
            </button>
            <button type="button" className="btn btn--outline" onClick={() => onSelectAuth('login')}>
              로그인
            </button>
          </div>
        </div>
        <div className="hero__preview" aria-hidden="true">
          <div className="hero__preview-card">
            <p className="hero__preview-title">실시간 미리보기</p>
            <div className="hero__preview-grid">
              {featureCards.map((feature) => (
                <article key={feature.title} className="hero-card">
                  <p className="hero-card__accent">{feature.accent}</p>
                  <h3 className="hero-card__title">{feature.title}</h3>
                  <p className="hero-card__description">{feature.description}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="workflow" aria-labelledby="workflow-heading">
        <div className="workflow__header">
          <p className="workflow__eyebrow">Workflow</p>
          <h2 id="workflow-heading" className="workflow__title">
            4단계로 완성되는 이미지 편집 파이프라인
          </h2>
          <p className="workflow__lead">
            준비된 템플릿과 자동화된 분석으로 브랜드 이미지를 빠르게 정리하세요.
          </p>
        </div>
        <ol className="workflow__list">
          {workflowSteps.map((step) => (
            <li key={step.title} className="workflow-step">
              <span className="workflow-step__index">{step.title}</span>
              <p className="workflow-step__detail">{step.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="editor-demo" aria-labelledby="editor-heading">
        <div className="editor-demo__header">
          <h2 id="editor-heading">AI 키워드 분석 미리보기</h2>
          <p>샘플 이미지를 기준으로 생성된 분석 패널을 확인하세요.</p>
        </div>
        <div className="editor-demo__body">
          <div className="editor-demo__canvas" role="presentation">
            <div className="editor-demo__canvas-inner">
              <p className="editor-demo__tag">Sample Image.png</p>
              <p className="editor-demo__note">배경이 제거된 피트니스 제품 촬영 이미지</p>
              <ul className="editor-demo__keywords">
                {keywordHighlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="editor-demo__panel">
            <AnalyzePanel />
          </div>
        </div>
        <Notification className="editor-demo__toast" />
      </section>

      <section className="plans" aria-labelledby="plans-heading">
        <div className="plans__header">
          <p className="plans__eyebrow">Pricing</p>
          <h2 id="plans-heading">팀의 규모에 맞는 요금제를 선택하세요</h2>
          <p className="plans__lead">무료로 시작한 뒤 성장 단계에 맞춰 손쉽게 업그레이드할 수 있습니다.</p>
        </div>
        <div className="plans__grid">
          {subscriptionPlans.map((plan) => (
            <article key={plan.name} className="plan-card">
              <header className="plan-card__header">
                <h3 className="plan-card__name">{plan.name}</h3>
                <p className="plan-card__price">{plan.price}</p>
                <p className="plan-card__description">{plan.description}</p>
              </header>
              <ul className="plan-card__features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button type="button" className="plan-card__cta" onClick={() => onSelectAuth('signup')}>
                플랜 선택하기
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState<View>('editor')

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__inner">
          <a href="#hero-heading" className="app-header__brand">
            <span className="app-header__logo" aria-hidden="true">
              🎨
            </span>
            <span className="app-header__title">Easy Image Editor</span>
          </a>
          <nav className="app-header__nav" aria-label="주요 메뉴">
            <button
              type="button"
              className={`app-header__nav-item${view === 'editor' ? ' is-active' : ''}`}
              onClick={() => setView('editor')}
            >
              제품 소개
            </button>
            <button
              type="button"
              className={`app-header__nav-item${view === 'login' ? ' is-active' : ''}`}
              onClick={() => setView('login')}
            >
              로그인
            </button>
            <button
              type="button"
              className={`app-header__nav-item${view === 'signup' ? ' is-active' : ''}`}
              onClick={() => setView('signup')}
            >
              회원가입
            </button>
          </nav>
        </div>
      </header>

      <main className="app-main">
        {view === 'editor' ? <EditorLanding onSelectAuth={setView} /> : null}
        {view === 'login' ? (
          <section className="auth-section" aria-labelledby="login-heading">
            <div className="auth-section__inner">
              <LoginPage />
            </div>
          </section>
        ) : null}
        {view === 'signup' ? (
          <section className="auth-section" aria-labelledby="signup-heading">
            <div className="auth-section__inner">
              <SignupPage />
            </div>
          </section>
        ) : null}
      </main>

      <footer className="app-footer">
        <div className="app-footer__inner">
          <p>© {new Date().getFullYear()} Easy Image Editor. All rights reserved.</p>
          <p>
            문의: <a href="mailto:hello@easy-image-editor.io">hello@easy-image-editor.io</a>
          </p>
        </div>
      </footer>
    </div>
  )
}
