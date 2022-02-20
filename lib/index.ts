/* eslint-disable @typescript-eslint/no-this-alias */
/**
 * mongo-tenant - Multi-tenancy for mongoose on document level.
 *
 * @copyright   Copyright (c) 2016-2017, craftup
 * @license     https://github.com/WeAreNova/mongoose-tenant/blob/main/LICENSE MIT
 */

import type mongodb from "mongodb";
import type {
  Aggregate,
  AnyKeys,
  AnyObject,
  Callback,
  CallbackWithoutResult,
  Connection,
  Document,
  FilterQuery,
  HydratedDocument,
  IndexDefinition,
  IndexOptions,
  InsertManyOptions,
  InsertManyResult,
  Model,
  PipelineStage,
  Query,
  QueryOptions,
  Schema,
} from "mongoose";
import type { BoundModel, MongoTenantOptions } from "./types";

const createBoundModel = <
  T,
  TQueryHelpers = Record<string, never>,
  TMethodsAndOverrides = Record<string, never>,
  TVirtuals = Record<string, never>,
>(
  BaseModel: Model<T, TQueryHelpers, TMethodsAndOverrides, TVirtuals>,
  tenantId: unknown,
  tenantIdKey: string,
  db: Connection,
): BoundModel<T, TQueryHelpers, TMethodsAndOverrides, TVirtuals> => {
  return class MongoTenantModel extends (BaseModel as Model<any>) {
    public db = db;
    public readonly hasTenantContext = true as const;
    public getTenant() {
      return tenantId as T[keyof T];
    }

    aggregate<R>(
      // eslint-disable-next-line @typescript-eslint/ban-types
      ...args: [pipeline?: PipelineStage[], options?: mongodb.AggregateOptions | Function, callback?: Callback<R[]>]
    ): Aggregate<R[]> {
      const [pipeline] = args;
      const tId = this.getTenant();

      if (!pipeline) {
        args[0] = [{ $match: { [tenantIdKey]: tId } }];
      } else if ((pipeline[0] as PipelineStage.Match).$match) {
        (pipeline[0] as PipelineStage.Match).$match[tenantIdKey] = tId;
      } else {
        pipeline.unshift({ $match: { [tenantIdKey]: tId } });
      }

      return super.aggregate.apply(this, args);
    }

    deleteOne(
      ...args: [
        filter?: FilterQuery<T> | CallbackWithoutResult,
        options?: QueryOptions | CallbackWithoutResult,
        callback?: CallbackWithoutResult,
      ]
    ) {
      const [filter] = args;
      const tId = this.getTenant();

      if (!filter || typeof filter === "function") {
        args.unshift({ [tenantIdKey as keyof T]: tId });
      } else {
        filter[tenantIdKey as keyof T] = tId;
      }
      return super.deleteOne(...args);
    }

    deleteMany(
      ...args: [
        filter?: FilterQuery<T> | CallbackWithoutResult,
        options?: QueryOptions | CallbackWithoutResult,
        callback?: CallbackWithoutResult,
      ]
    ) {
      const [filter] = args;
      const tId = this.getTenant();

      if (!filter || typeof filter === "function") {
        args.unshift({ [tenantIdKey as keyof T]: tId });
      } else {
        filter[tenantIdKey as keyof T] = tId;
      }
      return super.deleteMany(...args);
    }

    remove(
      ...args: [
        filter?: FilterQuery<T> | CallbackWithoutResult,
        options?: QueryOptions | CallbackWithoutResult,
        callback?: CallbackWithoutResult,
      ]
    ) {
      const [filter] = args;
      const tId = this.getTenant();

      if (!filter || typeof filter === "function") {
        args.unshift({ [tenantIdKey as keyof T]: tId });
      } else {
        filter[tenantIdKey as keyof T] = tId;
      }
      return super.remove(...args);
    }

    insertMany(
      docs: AnyKeys<T> | AnyObject | Array<AnyKeys<T> | AnyObject>,
      options?:
        | InsertManyOptions
        | Callback<Array<HydratedDocument<T, TMethodsAndOverrides, TVirtuals>> | InsertManyResult>,
      callback?: Callback<Array<HydratedDocument<T, TMethodsAndOverrides, TVirtuals>> | InsertManyResult>,
    ) {
      const tId = this.getTenant();
      const cb = typeof options === "function" ? options : callback;

      // Model.insertMany supports a single document as parameter
      if (!Array.isArray(docs)) {
        docs[tenantIdKey as keyof typeof docs] = tId;
      } else {
        docs.forEach(function (doc) {
          doc[tenantIdKey as keyof typeof doc] = tId;
        });
      }

      // ensure the returned docs are instanced of the bound multi tenant model
      return super.insertMany(
        docs,
        (err: Error | undefined, res: HydratedDocument<T, TMethodsAndOverrides, TVirtuals>[]) => {
          if (!cb) return;
          if (err) return cb(err, res);
          cb(
            null,
            res.map((doc) => new this(doc)),
          );
        },
      );
    }
  } as BoundModel<T, TQueryHelpers, TMethodsAndOverrides, TVirtuals>;
};

/**
 * MongoTenant is a class aimed for use in mongoose schema plugin scope.
 * It adds support for multi-tenancy on document level (adding a tenant reference field and include this in unique indexes).
 * Furthermore it provides an API for tenant bound models.
 */
class MongoTenant<S extends Schema, O extends MongoTenantOptions> {
  public schema: S;
  private options: Required<MongoTenantOptions>;
  private _modelCache: Record<string, Record<string, BoundModel<unknown>>>;

  /**
   * Create a new mongo tenant from a given schema.
   *
   * @param options - the configuration options.
   */
  constructor(schema: S, options: O = {} as O) {
    this._modelCache = {};
    this.schema = schema;
    this.options = {
      enabled: true,
      tenantIdKey: "tenant",
      tenantIdType: String,
      accessorMethod: "byTenant",
      requireTenantId: false,
      ...options,
    };
  }

  /**
   * Apply the mongo tenant plugin to the given schema.
   *
   */
  apply(): void {
    this.extendSchema().compoundIndexes().injectApi().installMiddleWare();
  }

  /**
   * Returns the boolean flag whether the mongo tenant is enabled.
   *
   * @returns {boolean}
   */
  isEnabled(): typeof this.options["enabled"] {
    return this.options.enabled;
  }

  /**
   * Return the name of the tenant id field. Defaults to **tenantId**.
   *
   * @returns {string}
   */
  getTenantIdKey(): typeof this.options["tenantIdKey"] {
    return this.options.tenantIdKey;
  }

  /**
   * Return the type of the tenant id field. Defaults to **String**.
   *
   * @returns {unknown}
   */
  getTenantIdType(): typeof this.options["tenantIdType"] {
    return this.options.tenantIdType;
  }

  /**
   * Return the method name for accessing tenant-bound models.
   *
   * @returns {string}
   */
  getAccessorMethod(): typeof this.options["accessorMethod"] {
    return this.options.accessorMethod;
  }

  /**
   * Check if tenant id is a required field.
   *
   * @return {boolean}
   */
  isTenantIdRequired(): typeof this.options["requireTenantId"] {
    return this.options.requireTenantId;
  }

  /**
   * Checks if instance is compatible to other plugin instance
   *
   * For population of referenced models it's necessary to detect if the tenant
   * plugin installed in these models is compatible to the plugin of the host
   * model. If they are compatible they are one the same "level".
   *
   * @param {MongoTenant} plugin
   */
  isCompatibleTo<T extends MongoTenant<Schema<unknown>, Record<string, unknown>>>(plugin?: T): boolean {
    return Boolean(
      plugin &&
        typeof plugin.getAccessorMethod === "function" &&
        typeof plugin.getTenantIdKey === "function" &&
        this.getTenantIdKey() === plugin.getTenantIdKey(),
    );
  }

  /**
   * Inject tenantId field into schema definition.
   */
  extendSchema(): this {
    if (!this.isEnabled()) return this;
    this.schema.add({
      [this.getTenantIdKey()]: {
        index: true,
        type: this.getTenantIdType(),
        required: this.isTenantIdRequired(),
      },
    });
    return this;
  }

  /**
   * Consider the tenant id field in all unique indexes (schema- and field level).
   * Take the optional **preserveUniqueKey** option into account for oupting out the default behaviour.
   */
  compoundIndexes(): this {
    if (!this.isEnabled()) return this;
    // apply tenancy awareness to schema level unique indexes
    this.schema.indexes().forEach((idx) => {
      const index = idx as unknown as [def: IndexDefinition, options: IndexOptions];
      // skip if `preserveUniqueKey` of the index is set to true
      if (index[1].unique !== true || index[1].preserveUniqueKey === true) return;

      const tenantAwareIndex: IndexDefinition = { [this.getTenantIdKey()]: 1 };
      for (const indexedField in index[0]) {
        tenantAwareIndex[indexedField] = index[0][indexedField];
      }
      index[0] = tenantAwareIndex;
    });

    // apply tenancy awareness to field level unique indexes
    this.schema.eachPath((key, path) => {
      if (path.options.unique !== true || path.options.preserveUniqueKey === true) return;
      // create a new one that includes the tenant id field
      this.schema.index(
        {
          [this.getTenantIdKey()]: 1,
          [key]: 1,
        },
        { ...path.options, unique: true },
      );
    });

    return this;
  }

  /**
   * Inject the user-space entry point for mongo tenant.
   * This method adds a static Model method to retrieve tenant bound sub-classes.
   *
   * @returns {MongoTenant}
   */
  injectApi(): this {
    const isEnabled = this.isEnabled();
    const modelCache = this._modelCache;
    const createTenantAwareModel = this.createTenantAwareModel.bind(this);

    this.schema.static(this.getAccessorMethod(), function (tenantId: unknown) {
      if (!isEnabled) return this;
      if (!modelCache[this.modelName]) modelCache[this.modelName] = {};

      const strTenantId = String(tenantId);
      const cachedModels = modelCache[this.modelName];
      // lookup tenant-bound model in cache
      if (!cachedModels[strTenantId]) {
        // Cache the tenant bound model class.
        cachedModels[strTenantId] = createTenantAwareModel(this, tenantId);
      }

      return cachedModels[strTenantId];
    });

    const self = this;
    Object.assign(this.schema.statics, {
      get mongoTenant() {
        return self;
      },
    });

    return this;
  }

  /**
   * Create a model class that is bound the given tenant.
   * So that all operations on this model prohibit leaving the tenant scope.
   *
   * @param BaseModel
   * @param tenantId
   */
  createTenantAwareModel<T extends Model<unknown>>(BaseModel: T, tenantId: unknown) {
    const tenantIdKey = this.getTenantIdKey();
    const db = this.createTenantAwareDb(BaseModel.db, tenantId);

    const MongoTenantModel = createBoundModel.call(this, BaseModel, tenantId, tenantIdKey, db);

    // inherit all static properties from the mongoose base model
    for (const staticProperty of Object.getOwnPropertyNames(BaseModel)) {
      if (
        Object.prototype.hasOwnProperty.call(MongoTenantModel, staticProperty) ||
        ["arguments", "caller"].indexOf(staticProperty) !== -1
      ) {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(BaseModel, staticProperty);
      if (descriptor) Object.defineProperty(MongoTenantModel, staticProperty, descriptor);
    }

    // create tenant models for discriminators if they exist
    if (BaseModel.discriminators) {
      MongoTenantModel.discriminators = {};

      for (const key in BaseModel.discriminators) {
        MongoTenantModel.discriminators[key] = this.createTenantAwareModel(BaseModel.discriminators[key], tenantId);
      }
    }

    return MongoTenantModel;
  }

  /**
   * Create db connection bound to a specific tenant
   *
   * @param {Connection} unawareDb
   * @param {*} tenantId
   * @returns {Connection}
   */
  createTenantAwareDb(unawareDb: Connection, tenantId: unknown): Connection {
    const self = this;
    const awareDb: Connection = Object.create(unawareDb);
    awareDb.model = (name: string) => {
      const unawareModel = unawareDb.model(name);
      const otherPlugin = unawareModel.mongoTenant;
      if (!self.isCompatibleTo(otherPlugin)) return unawareModel;
      return (unawareModel as any)[otherPlugin!.getAccessorMethod()](tenantId);
    };
    return awareDb;
  }

  /**
   * Install schema middleware to guard the tenant context of models.
   */
  installMiddleWare() {
    const tenantIdKey = this.getTenantIdKey();

    function preFindOrCount(this: Query<unknown, unknown>, next: () => void) {
      if (this.model.hasTenantContext) {
        this.setQuery({ ...this.getQuery(), [tenantIdKey]: this.model.getTenant!() });
      }
      next();
    }
    this.schema.pre("find", preFindOrCount);
    this.schema.pre("findOne", preFindOrCount);
    this.schema.pre("findOneAndRemove", preFindOrCount);
    this.schema.pre("count", preFindOrCount);
    this.schema.pre("countDocuments", preFindOrCount);

    function preUpdate(this: Query<unknown, unknown>, next: () => void) {
      if (this.model.hasTenantContext) {
        const tenantId = this.model.getTenant!();
        this.setQuery({ ...this.getQuery(), [tenantIdKey]: tenantId });
        this.set(tenantIdKey, tenantId);
      }
      next();
    }
    this.schema.pre("findOneAndUpdate", preUpdate);
    this.schema.pre("update", preUpdate);
    this.schema.pre("updateMany", preUpdate);

    this.schema.pre("save", function preSave(this: Document, next) {
      const model = this.constructor as Model<unknown>;
      if (model.hasTenantContext) this.set(tenantIdKey, model.getTenant!());
      next();
    });

    return this;
  }
}

/**
 * The mongo tenant mongoose plugin.
 *
 * @param {mongoose.Schema} schema
 * @param {Object} options
 */
function mongoTenantPlugin(schema: Schema, options: MongoTenantOptions) {
  const mongoTenant = new MongoTenant(schema, options);
  mongoTenant.apply();
}

export default mongoTenantPlugin;