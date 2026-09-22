import "server-only";

import { connect, schema } from "./connect";

export const db = connect();
export { schema };
