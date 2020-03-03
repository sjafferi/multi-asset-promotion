import { writable } from 'svelte/store';

export const ENVIRONMENTS = ["dev", "qa", "stag", "prod", "us2", "us1"]
export const FORM_STEPS = ["promote", "pick-related", "confirm"];

class FormState {
  constructor() {
    this.currentStep = writable(0);
    this.selectedAssets = writable([]);
    this.assets = writable([]);
    this.environment = writable(null);
    this.unsubscribeCallbacks = [];
  }

  subscribe(callback) {
    const { assets, currentStep, environment, selectedAssets, unsubscribeCallbacks } = this;
    unsubscribeCallbacks.push(assets.subscribe((value) => callback("assets", value)));
    unsubscribeCallbacks.push(environment.subscribe((value) => callback("environment", value)));
    unsubscribeCallbacks.push(currentStep.subscribe((value) => callback("currentStep", value)));
    unsubscribeCallbacks.push(selectedAssets.subscribe((value) => callback("selectedAssets", value)));
  }

  unsubscribe() {
    this.unsubscribeCallbacks.forEach(unsub => unsub());
  }

  reset() {
    this.currentStep.set(0);
    this.selectedAssets.set([]);
    this.environment.set(null);
  }

  nextStep() {
    return this.currentStep.update(n => n < FORM_STEPS.length - 1 ? n + 1 : n)
  }

  previousStep() {
    return this.currentStep.update(n => n > 0 ? n - 1 : n)
  }

  setSelectedAssets(rows) {
    return this.selectedAssets.set(rows);
  }

  setAssets(rows) {
    return this.assets.set(rows);
  }

  setEnvironment(env) {
    this.environment.set(env);
  }
}

export const formState = new FormState();