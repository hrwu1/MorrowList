"use client";

import {
  useMutation,
  type MutateOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";

import { useTaskFeedback } from "./use-task-feedback";

type TaskMutationOptions<TData, TError, TVariables, TContext> = Omit<
  UseMutationOptions<TData, TError, TVariables, TContext>,
  "onMutate"
> & {
  readonly onMutate?: (
    variables: TVariables,
    assertCurrent: () => void,
  ) => TContext | Promise<TContext>;
};

/**
 * Capture identity per execution, not per render: React Query can update a pending
 * mutation's callbacks after an account switch. Old results must not repopulate caches,
 * warnings or undo offers, including through a caller's per-invocation callbacks.
 */
export function useTaskMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>(options: TaskMutationOptions<TData, TError, TVariables, TContext>) {
  const { session } = useTaskFeedback();
  type Context = { readonly revision: number; readonly value: TContext | undefined };
  const mutation = useMutation<TData, TError, TVariables, Context>({
    ...options,
    onMutate: async (variables) => {
      const revision = session.current();
      const assertCurrent = () => {
        if (!session.isCurrent(revision)) throw new Error("This session has ended.");
      };
      assertCurrent();
      const value = await options.onMutate?.(variables, assertCurrent);
      assertCurrent();
      return { revision, value };
    },
    onSuccess: (data, variables, context) => {
      if (session.isCurrent(context.revision))
        return options.onSuccess?.(data, variables, context.value as TContext);
    },
    onError: (error, variables, context) => {
      if (context && session.isCurrent(context.revision))
        return options.onError?.(error, variables, context.value);
    },
    onSettled: (data, error, variables, context) => {
      if (context && session.isCurrent(context.revision))
        return options.onSettled?.(data, error, variables, context.value);
    },
  });
  function callbacks(
    options: MutateOptions<TData, TError, TVariables, TContext> | undefined,
  ): MutateOptions<TData, TError, TVariables, Context> {
    const revision = session.current();
    return {
      onSuccess: (data, variables, context) => {
        if (session.isCurrent(revision))
          options?.onSuccess?.(data, variables, context.value as TContext);
      },
      onError: (error, variables, context) => {
        if (session.isCurrent(revision))
          options?.onError?.(error, variables, context?.value);
      },
      onSettled: (data, error, variables, context) => {
        if (session.isCurrent(revision))
          options?.onSettled?.(data, error, variables, context?.value);
      },
    };
  }
  return {
    ...mutation,
    mutate: (
      variables: TVariables,
      options?: MutateOptions<TData, TError, TVariables, TContext>,
    ) => mutation.mutate(variables, callbacks(options)),
    mutateAsync: async (
      variables: TVariables,
      options?: MutateOptions<TData, TError, TVariables, TContext>,
    ): Promise<TData> => {
      const revision = session.current();
      try {
        const result = await mutation.mutateAsync(variables, callbacks(options));
        // An await continuation can navigate or announce a task, just like a callback.
        if (!session.isCurrent(revision)) throw new Error("This session has ended.");
        return result;
      } catch (error) {
        if (!session.isCurrent(revision)) throw new Error("This session has ended.");
        throw error;
      }
    },
  };
}
