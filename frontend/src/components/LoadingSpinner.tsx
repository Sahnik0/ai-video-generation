type LoadingSpinnerProps = {
  message?: string;
};

export function LoadingSpinner({ message }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-steel border-opacity-30 rounded-full dark:border-haze"></div>
        <div className="absolute top-0 left-0 w-16 h-16 border-4 border-signal border-t-transparent rounded-full animate-spin dark:border-orange-300"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-signal rounded-full animate-pulse dark:bg-orange-300"></div>
      </div>
      {message && (
        <p className="mt-4 text-steel font-medium text-center dark:text-bone">
          {message}
        </p>
      )}
    </div>
  );
}