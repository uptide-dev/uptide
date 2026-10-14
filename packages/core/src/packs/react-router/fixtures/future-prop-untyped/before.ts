import { ComponentType, createElement, ReactElement } from 'react';
import { MemoryRouter as Memory } from 'react-router';

const FLAGS = { v7_relativeSplatPath: true };
type RouterModule = { BrowserRouter: ComponentType<Record<string, unknown>> };

export const withFlags = (actual: RouterModule) => ({
  BrowserRouter: (props: Record<string, unknown>): ReactElement =>
    createElement(actual.BrowserRouter, { future: FLAGS, ...props }), // @uptide future-prop-untyped at:createElement
  MemoryRouter: (props: Record<string, unknown>): ReactElement =>
    createElement(Memory, { future: FLAGS, ...props }), // @uptide future-prop-untyped at:createElement
});
export const plain = (actual: RouterModule) => createElement(actual.BrowserRouter, { basename: '/' }); // @uptide future-prop-untyped keep at:createElement
export const other = (Widget: ComponentType<object>) => createElement(Widget, { future: FLAGS }); // @uptide future-prop-untyped keep at:createElement
