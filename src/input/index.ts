/**
 * Input module (PLAN §2, §7, §8): keyboard, pointer (touch) and gamepad
 * sources that all emit the same InputEvent.
 */
export * from './types.ts';
export { createKeyboardSource, isEditableTarget } from './keyboard.ts';
export { createPointerSource } from './pointer.ts';
export { createGamepadSource, type GamepadSourceOptions } from './gamepad.ts';
