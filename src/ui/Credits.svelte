<script lang="ts">
  import { MUSIC, TOOLS } from '../app/credits.ts';
  import { screen } from '../app/screen.svelte.ts';
  import Button from './components/Button.svelte';
</script>

<main class="screen">
  <header class="screen-head">
    <h1>크레딧</h1>
    <Button id="credits-back" variant="primary" onclick={() => screen.go({ name: 'settings' })}>돌아가기</Button>
  </header>

  <section aria-labelledby="h-music">
    <h2 id="h-music">음악</h2>
    <ul class="list">
      {#each MUSIC as song (song.title)}
        <li>
          <p><span class="name">{song.title}</span> <span class="dim">{song.artist}</span></p>
          {#if song.source}
            <p class="dim caption">
              원곡
              <a href={song.source.url} target="_blank" rel="noopener noreferrer">"{song.source.title}"</a>
              by {song.artist},
              <a href={song.source.license.url} target="_blank" rel="noopener noreferrer">{song.source.license.name}</a>
              {#if song.source.changes}· {song.source.changes}{/if}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  </section>

  <section aria-labelledby="h-art">
    <h2 id="h-art">채보와 자켓</h2>
    <p class="dim caption">모든 채보는 AI(Mapperatorinator)가 생성했고, 자켓 일러스트도 AI로 만들었습니다.</p>
  </section>

  <section aria-labelledby="h-tools">
    <h2 id="h-tools">사용한 도구</h2>
    <ul class="list">
      {#each TOOLS as tool (tool.name)}
        <li>
          <p>
            <a class="name" href={tool.url} target="_blank" rel="noopener noreferrer">{tool.name}</a>
            <span class="dim">{tool.by}</span>
          </p>
          <p class="dim caption">{tool.role}</p>
        </li>
      {/each}
    </ul>
  </section>
</main>

<style>
  h1 {
    font-size: 20px;
    font-weight: 500;
  }

  section {
    display: grid;
    gap: 12px;
  }

  h2 {
    font-size: 16px;
    font-weight: 500;
    color: var(--text-dim);
  }

  .list {
    display: grid;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .name {
    font-weight: 500;
  }

  a {
    color: var(--kat-ink);
    text-underline-offset: 3px;
  }

  a:focus-visible {
    outline: 2px solid var(--kat);
    outline-offset: 2px;
  }
</style>
