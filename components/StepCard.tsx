import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';

interface StepCardProps {
  title: string;
  description: string;
  isActive: boolean;
  isCompleted: boolean;
  alwaysShowChildren?: boolean;
  children?: React.ReactNode;
  stepNumber: number;
}

export const StepCard: React.FC<StepCardProps> = ({
  title,
  description,
  isActive,
  isCompleted,
  alwaysShowChildren = false,
  children,
  stepNumber
}) => {
  return (
    <div className={`
      relative p-6 rounded-xl border-2 transition-all duration-300
      ${isActive ? 'border-indigo-500 bg-white shadow-lg' : 'border-slate-200 bg-slate-50 opacity-70'}
      ${isCompleted ? 'border-green-500 bg-green-50/50 opacity-100' : ''}
    `}>
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-1">
            {isCompleted ? (
                <CheckCircle2 className="w-8 h-8 text-green-500" />
            ) : (
                <div className={`
                    flex items-center justify-center w-8 h-8 rounded-full border-2 font-bold
                    ${isActive ? 'border-indigo-500 text-indigo-600' : 'border-slate-300 text-slate-400'}
                `}>
                    {stepNumber}
                </div>
            )}
        </div>
        <div className="flex-1">
          <h3 className={`text-lg font-semibold ${isActive || isCompleted ? 'text-slate-900' : 'text-slate-500'}`}>
            {title}
          </h3>
          <p className="text-sm text-slate-500 mb-4">{description}</p>
          {(isActive || isCompleted || alwaysShowChildren) && children}
        </div>
      </div>
    </div>
  );
};
