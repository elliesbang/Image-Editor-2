import type { JSX } from 'hono/jsx'

type NotificationProps = {
  id?: string
  className?: string
}

const Notification = ({ id = 'background-toast', className = '' }: NotificationProps): JSX.Element => {
  return (
    <div
      id={id}
      class={`bg-removal-toast ${className}`.trim()}
      data-role="background-toast"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden="true"
      hidden
    >
      <span class="bg-removal-toast__message" data-role="background-toast-message"></span>
    </div>
  )
}

export default Notification
