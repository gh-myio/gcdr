import { Router, Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../middleware/response';

const router = Router();

/**
 * Metric Domain definitions
 * These are the available metrics for alarm rules
 */
interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  category: 'continuous' | 'discrete';
  unit?: string;
  defaultAggregation: 'AVG' | 'SUM' | 'MIN' | 'MAX' | 'COUNT' | 'LAST';
  values?: { value: number; label: string }[];
  deviceMetadata?: string[];
}

const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Continuous metrics
  {
    id: 'temperature',
    name: 'Temperature',
    description: 'Temperature sensor reading',
    category: 'continuous',
    unit: '°C',
    defaultAggregation: 'AVG',
  },
  {
    id: 'humidity',
    name: 'Humidity',
    description: 'Relative humidity sensor reading',
    category: 'continuous',
    unit: '%',
    defaultAggregation: 'AVG',
  },
  {
    id: 'instantaneous_power',
    name: 'Instantaneous Power',
    description: 'Current power consumption',
    category: 'continuous',
    unit: 'W',
    defaultAggregation: 'AVG',
  },
  {
    id: 'energy_consumption',
    name: 'Energy Consumption',
    description: 'Total energy consumed',
    category: 'continuous',
    unit: 'Wh',
    defaultAggregation: 'SUM',
  },
  {
    id: 'water_flow',
    name: 'Water Flow',
    description: 'Water flow rate',
    category: 'continuous',
    unit: 'L',
    defaultAggregation: 'SUM',
  },
  {
    id: 'water_level_continuous',
    name: 'Water Level (Continuous)',
    description: 'Continuous water level reading',
    category: 'continuous',
    unit: '%',
    defaultAggregation: 'LAST',
  },
  {
    id: 'water_level_discreet',
    name: 'Water Level (Discrete)',
    description: 'Discrete water level reading',
    category: 'continuous',
    unit: '%',
    defaultAggregation: 'LAST',
  },
  // Discrete (binary) metrics
  {
    id: 'sensor',
    name: 'Generic Sensor',
    description: 'Generic binary sensor',
    category: 'discrete',
    defaultAggregation: 'LAST',
    values: [
      { value: 0, label: 'Off' },
      { value: 1, label: 'On' },
    ],
    deviceMetadata: ['channelId', 'value'],
  },
  {
    id: 'presence_sensor',
    name: 'Presence Sensor',
    description: 'Presence detection sensor',
    category: 'discrete',
    defaultAggregation: 'LAST',
    values: [
      { value: 0, label: 'Not Detected' },
      { value: 1, label: 'Detected' },
    ],
    deviceMetadata: ['channelId', 'value'],
  },
  {
    id: 'door_sensor',
    name: 'Door Sensor',
    description: 'Door open/close sensor',
    category: 'discrete',
    defaultAggregation: 'LAST',
    values: [
      { value: 0, label: 'Closed' },
      { value: 1, label: 'Open' },
    ],
    deviceMetadata: ['channelId', 'value'],
  },
  {
    id: 'lamp',
    name: 'Lamp',
    description: 'Lamp output control',
    category: 'discrete',
    defaultAggregation: 'LAST',
    values: [
      { value: 0, label: 'On' },
      { value: 1, label: 'Off' },
    ],
    deviceMetadata: ['channelId', 'value'],
  },
];

/**
 * Comparison operators available for rules
 */
interface OperatorDefinition {
  id: string;
  name: string;
  description: string;
  requiresValueHigh: boolean;
  applicableTo: ('continuous' | 'discrete')[];
}

const OPERATOR_DEFINITIONS: OperatorDefinition[] = [
  {
    id: 'GT',
    name: 'Greater Than',
    description: 'Value is greater than threshold',
    requiresValueHigh: false,
    applicableTo: ['continuous'],
  },
  {
    id: 'GTE',
    name: 'Greater Than or Equal',
    description: 'Value is greater than or equal to threshold',
    requiresValueHigh: false,
    applicableTo: ['continuous'],
  },
  {
    id: 'LT',
    name: 'Less Than',
    description: 'Value is less than threshold',
    requiresValueHigh: false,
    applicableTo: ['continuous'],
  },
  {
    id: 'LTE',
    name: 'Less Than or Equal',
    description: 'Value is less than or equal to threshold',
    requiresValueHigh: false,
    applicableTo: ['continuous'],
  },
  {
    id: 'EQ',
    name: 'Equal',
    description: 'Value equals threshold',
    requiresValueHigh: false,
    applicableTo: ['continuous', 'discrete'],
  },
  {
    id: 'NEQ',
    name: 'Not Equal',
    description: 'Value does not equal threshold',
    requiresValueHigh: false,
    applicableTo: ['continuous', 'discrete'],
  },
  {
    id: 'BETWEEN',
    name: 'Between',
    description: 'Value is between value and valueHigh (inclusive)',
    requiresValueHigh: true,
    applicableTo: ['continuous'],
  },
  {
    id: 'OUTSIDE',
    name: 'Outside',
    description: 'Value is outside the range of value and valueHigh',
    requiresValueHigh: true,
    applicableTo: ['continuous'],
  },
];

/**
 * Aggregation types available
 */
interface AggregationDefinition {
  id: string;
  name: string;
  description: string;
}

const AGGREGATION_DEFINITIONS: AggregationDefinition[] = [
  { id: 'AVG', name: 'Average', description: 'Average of values in the window' },
  { id: 'MIN', name: 'Minimum', description: 'Minimum value in the window' },
  { id: 'MAX', name: 'Maximum', description: 'Maximum value in the window' },
  { id: 'SUM', name: 'Sum', description: 'Sum of values in the window' },
  { id: 'COUNT', name: 'Count', description: 'Count of values in the window' },
  { id: 'LAST', name: 'Last', description: 'Most recent value' },
];

/**
 * Rule priorities
 */
interface PriorityDefinition {
  id: string;
  name: string;
  level: number;
  color: string;
}

const PRIORITY_DEFINITIONS: PriorityDefinition[] = [
  { id: 'LOW', name: 'Low', level: 1, color: '#4CAF50' },
  { id: 'MEDIUM', name: 'Medium', level: 2, color: '#FF9800' },
  { id: 'HIGH', name: 'High', level: 3, color: '#F44336' },
  { id: 'CRITICAL', name: 'Critical', level: 4, color: '#9C27B0' },
];

/**
 * GET /domains
 * Get all domain definitions (metrics, operators, aggregations, priorities)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;

    sendSuccess(res, {
      metrics: METRIC_DEFINITIONS,
      operators: OPERATOR_DEFINITIONS,
      aggregations: AGGREGATION_DEFINITIONS,
      priorities: PRIORITY_DEFINITIONS,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /domains/metrics
 * Get only metric definitions
 */
router.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { category } = req.query;

    let metrics = METRIC_DEFINITIONS;

    if (category === 'continuous' || category === 'discrete') {
      metrics = metrics.filter(m => m.category === category);
    }

    sendSuccess(res, metrics, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /domains/metrics/:id
 * Get a specific metric definition
 */
router.get('/metrics/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    const { id } = req.params;

    const metric = METRIC_DEFINITIONS.find(m => m.id === id);

    if (!metric) {
      return res.status(404).json({
        success: false,
        error: { message: `Metric '${id}' not found`, code: 'NOT_FOUND' },
      });
    }

    // Get applicable operators for this metric
    const applicableOperators = OPERATOR_DEFINITIONS.filter(
      op => op.applicableTo.includes(metric.category)
    );

    sendSuccess(res, {
      ...metric,
      applicableOperators,
    }, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /domains/operators
 * Get only operator definitions
 */
router.get('/operators', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    sendSuccess(res, OPERATOR_DEFINITIONS, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /domains/aggregations
 * Get only aggregation definitions
 */
router.get('/aggregations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    sendSuccess(res, AGGREGATION_DEFINITIONS, 200, requestId);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /domains/priorities
 * Get only priority definitions
 */
router.get('/priorities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { requestId } = req.context;
    sendSuccess(res, PRIORITY_DEFINITIONS, 200, requestId);
  } catch (err) {
    next(err);
  }
});

export default router;
