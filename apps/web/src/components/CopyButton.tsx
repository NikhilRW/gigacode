import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';

/** Copies text to the clipboard and confirms it; tells the user how to proceed if the browser blocks it. */
export function CopyButton({
  text,
  label = 'Copy',
  variant = 'ghost',
  size = 'sm',
  className,
}: {
  text: string;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className ?? 'h-7 gap-1.5 px-2 text-xs'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy automatically. Select the text and copy it manually.');
        }
      }}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
