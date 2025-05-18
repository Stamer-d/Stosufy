<script>
  import { onMount, createEventDispatcher } from 'svelte';  
  
  // Props
  export let isOpen = false;
  export let buttonClass = '';
  export let menuClass = '';
  
  // State
  let dropdownContainer;

  const dispatch = createEventDispatcher();
 
  // Close dropdown when clicking outside
  function handleClickOutside(event) {
    if (dropdownContainer && !dropdownContainer.contains(event.target)) {
      isOpen = false;
      dispatch('close');
    }
  }

  // Toggle dropdown visibility
  function toggleDropdown() {
    isOpen = !isOpen;
    dispatch(isOpen ? 'open' : 'close');
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });
</script>

<div class="relative inline-block" bind:this={dropdownContainer}>
  <!-- Dropdown trigger -->
  <div on:click={toggleDropdown} class="cursor-pointer">
    <slot name="trigger"/>
  </div>

  <!-- Dropdown menu -->
  {#if isOpen}
    <div 
      class="absolute right-0 z-30 w-64 mt-2 origin-top-right bg-secondary-200 rounded-lg p-2 {menuClass}"
      role="menu"
      aria-orientation="vertical"
    >
      <slot name="menu">
        <div class="py-1 text-white text-sm">No Content provided</div>
      </slot>
    </div>
  {/if}
</div>