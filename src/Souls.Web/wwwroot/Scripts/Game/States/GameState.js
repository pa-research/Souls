define("gamestate", [], function () {

    return GAME_STATE =
        {
            MENU: 0,
            IN_GAME: 1,
            PAUSED: 2,
            DEFEAT: 3,
            VICTORY: 4,
            LOADING: 5,
            NOT_SUPPORTED: 6
        };

});