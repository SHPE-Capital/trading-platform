/**
 * core/oms/parentChildOrder.ts
 *
 * Tracks parent-child order relationships for algorithmic execution strategies
 * (TWAP, VWAP). A parent order represents the full intent; child orders are
 * the individual slices submitted to the market over time.
 *
 * Inputs:  OrderIntent, algo params (TwapParams | VwapParams), child fill events.
 * Outputs: Parent and child order state for algo execution tracking and monitoring.
 */

import { newId } from "../../utils/ids";
import { nowMs } from "../../utils/time";
import { logger } from "../../utils/logger";
import type { UUID, ExecutionAlgoType } from "../../types/common";
import type { ParentOrder, ChildOrder, TwapParams, VwapParams } from "../../types/oms";
import type { OrderIntent } from "../../types/orders";
import type { Fill } from "../../types/orders";

export class ParentChildOrderTracker {
  private readonly _parents: Map<UUID, ParentOrder> = new Map();
  private readonly _children: Map<UUID, ChildOrder> = new Map();

  /**
   * Registers a new parent order for an algo-executed intent.
   * @param intent - The original OrderIntent being executed algorithmically
   * @param algoType - Which execution algorithm is handling this parent
   * @param algoParams - Algo-specific parameters (TwapParams or VwapParams)
   * @returns The created ParentOrder
   */
  createParent(
    intent: OrderIntent,
    algoType: ExecutionAlgoType,
    algoParams: TwapParams | VwapParams,
  ): ParentOrder {
    const parent: ParentOrder = {
      parentId: newId(),
      intentId: intent.id,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      totalQty: intent.qty,
      filledQty: 0,
      childIds: [],
      algoType,
      algoParams,
      createdAt: nowMs(),
    };

    this._parents.set(parent.parentId, parent);
    logger.info("ParentChildOrderTracker: parent created", {
      parentId: parent.parentId,
      intentId: intent.id,
      symbol: intent.symbol,
      totalQty: intent.qty,
      algoType,
    });

    return parent;
  }

  /**
   * Registers a child order slice for an existing parent.
   * @param parentId - ID of the parent order
   * @param childIntent - The child OrderIntent that was submitted for this slice
   * @returns The created ChildOrder
   */
  addChild(parentId: UUID, childIntent: OrderIntent): ChildOrder {
    const parent = this._parents.get(parentId);
    if (!parent) {
      throw new Error(`ParentChildOrderTracker: parent ${parentId} not found`);
    }

    // Determine total slices from algo params
    let totalSlices = 0;
    if ("numSlices" in parent.algoParams) {
      totalSlices = (parent.algoParams as TwapParams).numSlices;
    }

    const child: ChildOrder = {
      childId: newId(),
      parentId,
      intentId: childIntent.id,
      sliceIndex: parent.childIds.length,
      totalSlices,
      qty: childIntent.qty,
      filledQty: 0,
      submittedAt: nowMs(),
    };

    parent.childIds.push(child.childId);
    this._children.set(child.childId, child);

    logger.info("ParentChildOrderTracker: child added", {
      childId: child.childId,
      parentId,
      sliceIndex: child.sliceIndex,
      qty: child.qty,
    });

    return child;
  }

  /**
   * Updates fill accounting for a child order when a fill event arrives.
   * Accumulates fill qty into both child and parent, marks completion when done.
   * @param childOrderId - ID of the child order that was filled
   * @param fill - Fill event from the execution sink
   */
  onChildFill(childOrderId: UUID, fill: Fill): void {
    const child = this._children.get(childOrderId);
    if (!child) {
      logger.warn("ParentChildOrderTracker: onChildFill — child not found", { childOrderId });
      return;
    }

    // Accumulate fill qty into child
    child.filledQty += fill.qty;

    // Mark child as filled if complete
    if (child.filledQty >= child.qty) {
      child.filledAt = fill.ts;
    }

    // Accumulate fill qty into parent
    const parent = this._parents.get(child.parentId);
    if (!parent) {
      logger.warn("ParentChildOrderTracker: onChildFill — parent not found", {
        parentId: child.parentId,
      });
      return;
    }

    parent.filledQty += fill.qty;

    // Mark parent as complete if fully filled
    if (this.isComplete(parent.parentId)) {
      parent.completedAt = fill.ts;
      logger.info("ParentChildOrderTracker: parent fully filled", {
        parentId: parent.parentId,
        totalQty: parent.totalQty,
        filledQty: parent.filledQty,
      });
    } else {
      logger.info("ParentChildOrderTracker: child fill recorded", {
        childOrderId,
        childFilledQty: child.filledQty,
        parentFilledQty: parent.filledQty,
        parentTotalQty: parent.totalQty,
        fillQty: fill.qty,
        fillPrice: fill.price,
      });
    }
  }

  /**
   * Returns a parent order by ID, or null if not found.
   * @param parentId - ID of the parent order
   * @returns ParentOrder or null
   */
  getParent(parentId: UUID): ParentOrder | null {
    return this._parents.get(parentId) ?? null;
  }

  /**
   * Returns a child order by ID, or null if not found.
   * @param childId - ID of the child order
   * @returns ChildOrder or null
   */
  getChild(childId: UUID): ChildOrder | null {
    return this._children.get(childId) ?? null;
  }

  /**
   * Checks whether a parent order has been fully filled.
   * @param parentId - ID of the parent order
   * @returns True when all qty is filled, false otherwise
   */
  isComplete(parentId: UUID): boolean {
    const parent = this._parents.get(parentId);
    if (!parent) return false;
    return parent.filledQty >= parent.totalQty;
  }

  /**
   * Returns all parent orders that have not yet completed.
   * @returns Array of incomplete ParentOrders
   */
  getPendingParents(): ParentOrder[] {
    return [...this._parents.values()].filter((p) => p.completedAt === undefined);
  }

  /**
   * Clears all parent and child order state. Used in tests and on engine stop.
   */
  clear(): void {
    this._parents.clear();
    this._children.clear();
  }
}
