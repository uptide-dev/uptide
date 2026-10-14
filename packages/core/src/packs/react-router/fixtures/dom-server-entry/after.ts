import { StaticRouter, createStaticHandler } from 'react-router'; // @uptide dom-server-entry at:'react-router-dom/server'
import type { StaticHandlerContext } from "react-router"; // @uptide dom-server-entry at:"react-router-dom/server"
import { renderToString } from 'react-dom/server'; // @uptide dom-server-entry keep at:'react-dom/server'

export const handler = createStaticHandler([]);
export const render = (context: StaticHandlerContext) => renderToString(StaticRouter as never);
