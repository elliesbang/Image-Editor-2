import type { HTMLAttributes } from 'react'

type NotificationProps = HTMLAttributes<HTMLDivElement> & {
  id?: string
}

const Notification = ({ id = 'background-toast', className = '', ...rest }: NotificationProps) => {
  const classNames = ['bg-removal-toast']
  if (className) {
    classNames.push(className)
  }

  return (
    <div
      id={id}
      className={classNames.join(' ')}
      data-role="background-toast"
      aria-live="polite"
      aria-atomic="true"
      aria-hidden="true"
      hidden
      {...rest}
    >
      <span className="bg-removal-toast__message" data-role="background-toast-message" />
    </div>
  )
}

export default Notification
