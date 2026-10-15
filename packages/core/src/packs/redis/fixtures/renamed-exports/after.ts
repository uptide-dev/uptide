import { SCHEMA_FIELD_TYPE as SchemaFieldTypes, FT_AGGREGATE_STEPS as AggregateSteps } from 'redis'; // @uptide renamed-exports at:SchemaFieldTypes
import { TimeSeriesAggregationType } from '@redis/time-series'; // @uptide renamed-exports keep at:TimeSeriesAggregationType
import { FtSearchOptions as QueryOptions } from 'redis'; // @uptide renamed-exports at:SearchOptions

export const schema = {
  title: { type: SchemaFieldTypes.TEXT },
  tags: { type: SchemaFieldTypes.TAG },
};
export const steps = [AggregateSteps.GROUPBY];
// AVERAGE is AVG in 5: an alias would leave this member undefined.
export const avg = TimeSeriesAggregationType.AVERAGE;
export const query: QueryOptions = { LIMIT: { from: 0, size: 5 } };
